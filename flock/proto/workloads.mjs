// PROTOTYPE (map #1292, ticket 4). The two workloads: BASE files, tasks, facts.
// A fact is one command whose exit code is the answer, run in a copy of the code.
import fs from 'node:fs'
import path from 'node:path'

const PY = (src) => ['python3', '-c', src]

// ── 1. the parser's fixture plan (evals/fixtures/claims/plan.md): routine, disjoint files ──
const widgetkit = {
  name: 'widgetkit',
  base: {
    'widgetkit/__init__.py': '',
    'tests/__init__.py': '',
    'conftest.py': '',
    'README.md': '# widgetkit (prototype target)\n',
  },
  check: ['python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider'],
  tasks: [
    { id: '1', title: 'The widget constructor', depends_on: [],
      body: `Create \`widgetkit/widget.py\` with a dataclass \`Widget\` carrying one field, \`size: int\`, and a function \`make_widget(n: int) -> Widget\`.
Claim: an operator asks for a widget of a given size and gets one back, or a clear error when the size is not a positive whole number.
Machine: \`make_widget(3)\` returns a \`Widget\` whose \`size\` is \`3\`; \`make_widget(0)\` and \`make_widget(-1)\` each raise \`ValueError("size must be positive")\`.`,
      facts: [
        PY('from widgetkit.widget import make_widget; assert make_widget(3).size == 3'),
        PY("from widgetkit.widget import make_widget\nfor n in (0, -1):\n    try:\n        make_widget(n)\n    except ValueError as e:\n        assert str(e) == 'size must be positive'\n    else:\n        raise SystemExit(1)"),
      ] },
    { id: '2', title: 'The widget catalog', depends_on: ['1'],
      body: `Create \`widgetkit/catalog.py\` with \`catalog(sizes: list[int]) -> list[Widget]\`, a thin mapping over \`make_widget(n: int) -> Widget\` from \`widgetkit/widget.py\` (task 1 produces it). It neither validates nor catches: an invalid size raises the constructor's own \`ValueError\`.
Claim: an operator lists the sizes they want and gets one widget per size, in the order given.
Machine: \`catalog([1, 3])\` returns a list of two \`Widget\`s whose \`size\` values are \`[1, 3]\`; \`catalog([])\` returns \`[]\`.`,
      facts: [PY('from widgetkit.catalog import catalog; assert [w.size for w in catalog([1, 3])] == [1, 3]; assert catalog([]) == []')] },
    { id: '3', title: 'Size formatting', depends_on: [],
      body: `Create \`widgetkit/format.py\` with \`format_size(n: int) -> str\`. It takes an integer, not a \`Widget\`, and shares no symbol and no file with the constructor or the catalog.
Claim: an operator reading a size in a report sees millimetres spelled out rather than a bare number.
Machine: \`format_size(3)\` returns \`"3 mm"\`; \`format_size(0)\` returns \`"0 mm"\`.`,
      facts: [PY("from widgetkit.format import format_size; assert format_size(3) == '3 mm' and format_size(0) == '0 mm'")] },
  ],
}

// ── 2. built to collide: three tasks, one module, a producer/consumer edge, a cross-cutting rename ──
const CORE = `from dataclasses import dataclass


@dataclass
class Item:
    name: str
    qty: int
    price: float


def parse_line(line):
    raise NotImplementedError


def total_value(items):
    raise NotImplementedError


def restock(items, name, amount):
    raise NotImplementedError
`
const SHARED = `All three tasks edit \`inventory/core.py\` at the same time as each other. Task 3 renames the \`Item\` field \`qty\` to \`quantity\` everywhere; the final name is \`quantity\`, so write new code against \`quantity\`.`
const inventory = {
  name: 'inventory',
  base: {
    'inventory/__init__.py': '',
    'inventory/core.py': CORE,
    'tests/__init__.py': '',
    'tests/test_core.py': `from inventory.core import Item\n\n\ndef test_item_holds_its_fields():\n    i = Item("bolt", 2, 0.5)\n    assert i.name == "bolt" and i.price == 0.5\n`,
    'conftest.py': '',
  },
  check: ['python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider'],
  tasks: [
    { id: '1', title: 'Parse a stock line', depends_on: [],
      body: `${SHARED}
In \`inventory/core.py\`, implement \`parse_line(line: str) -> Item\` for lines of the form \`name,quantity,price\` with an optional fourth column \`sku\`. Add a field \`sku\` to \`Item\` after \`price\`: an optional string, default \`None\` (Python 3.9: annotate it \`Optional[str]\`).
Machine: \`parse_line("widget,3,2.50")\` returns \`Item(name="widget", quantity=3, price=2.5, sku=None)\`; \`parse_line("bolt,1,0.10,B-7").sku == "B-7"\`; a line without at least three columns, or whose quantity is not an integer, raises \`ValueError("bad line")\`.`,
      facts: [
        PY("from inventory.core import parse_line\ni = parse_line('widget,3,2.50')\nassert (i.name, i.quantity, i.price, i.sku) == ('widget', 3, 2.5, None)\nassert parse_line('bolt,1,0.10,B-7').sku == 'B-7'"),
        PY("from inventory.core import parse_line\nfor bad in ('nope', 'a,x,1'):\n    try:\n        parse_line(bad)\n    except ValueError as e:\n        assert str(e) == 'bad line'\n    else:\n        raise SystemExit(1)"),
      ] },
    { id: '2', title: 'Value a stock list', depends_on: ['1'],
      body: `${SHARED}
In \`inventory/core.py\`, implement \`total_value(items) -> float\` (the sum of quantity × price) and add \`load(text: str) -> list[Item]\`, which parses every non-blank line with \`parse_line(line: str) -> Item\` from task 1.
Machine: \`total_value([Item("a", 2, 1.5), Item("b", 1, 3.0)]) == 6.0\`; \`total_value([]) == 0\`; \`[i.quantity for i in load("a,2,1.5\\n\\nb,1,3\\n")] == [2, 1]\`.`,
      facts: [
        PY("from inventory.core import Item, total_value\nassert total_value([Item('a', 2, 1.5), Item('b', 1, 3.0)]) == 6.0\nassert total_value([]) == 0"),
        PY("from inventory.core import load\nassert [i.quantity for i in load('a,2,1.5\\n\\nb,1,3\\n')] == [2, 1]"),
      ] },
    { id: '3', title: 'Restock, and rename qty to quantity', depends_on: [],
      body: `${SHARED}
In \`inventory/core.py\`, rename the \`Item\` field \`qty\` to \`quantity\` everywhere it appears in \`inventory/\` and \`tests/\`, and implement \`restock(items, name, amount) -> list[Item]\`: it returns a new list in which the item called \`name\` has its quantity increased by \`amount\`, leaving the input untouched.
Machine: restocking \`"a"\` by 3 in \`[Item("a", 1, 1.0)]\` gives quantity \`4\` and leaves the original at \`1\`; an unknown name raises \`KeyError(name)\`; \`amount <= 0\` raises \`ValueError("amount must be positive")\`; no word \`qty\` remains in \`inventory/core.py\`.`,
      facts: [
        PY("from inventory.core import Item, restock\nsrc = [Item('a', 1, 1.0)]\nout = restock(src, 'a', 3)\nassert out[0].quantity == 4 and src[0].quantity == 1"),
        PY("from inventory.core import Item, restock\ntry:\n    restock([Item('a', 1, 1.0)], 'zz', 1)\nexcept KeyError:\n    pass\nelse:\n    raise SystemExit(1)\ntry:\n    restock([Item('a', 1, 1.0)], 'a', 0)\nexcept ValueError as e:\n    assert str(e) == 'amount must be positive'\nelse:\n    raise SystemExit(1)"),
        PY("import re; assert not re.search(r'\\bqty\\b', open('inventory/core.py').read())"),
      ] },
  ],
}

export const WORKLOADS = { widgetkit, inventory }

export function writeBase (w, dir) {
  for (const [p, text] of Object.entries(w.base)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), text)
  }
}

// ── like-for-like with the fleet baseline (2026-09-25): each task's body is the signed
// plan's own task section, and its facts are that plan's `Run:` commands, verbatim ──
const HERE_W = path.dirname(new URL(import.meta.url).pathname)
function fromPlan (w, file) {
  const text = fs.readFileSync(path.join(HERE_W, 'plans', file), 'utf8')
  const sections = text.split(/^### Task /m).slice(1)
  for (const t of w.tasks) {
    const s = sections.find((x) => x.startsWith(t.id + ':'))
    if (!s) throw new Error(`plan ${file} has no task ${t.id}`)
    t.body = 'Task ' + s.trim()
    t.facts = [...s.matchAll(/^- Run: (.*?)\s*\[M[\d, M]+\]\s*$/gm)].map((m) => ['bash', '-lc', m[1]])
    if (!t.facts.length) throw new Error(`task ${t.id} of ${file} has no Run lines`)
    // the task's own Files (gap 9: an edit elsewhere is counted as a declared amendment)
    const files = s.split(/\*\*Files:\*\*/)[1]
    t.files = files ? [...files.split(/\n\n\*\*/)[0].matchAll(/^- (?:Modify|Create|Delete): `([^`]+)`/gm)].map((m) => m[1]) : null
  }
}
fromPlan(widgetkit, '2026-09-25-flock-baseline-widgetkit.md')
fromPlan(inventory, '2026-09-25-flock-baseline-inventory.md')
// and both start from the same BASE the fleet does: flock-baseline@24397a5a holds both packages
const BASELINE_README = '# flock-baseline\n'
widgetkit.base = inventory.base = { ...widgetkit.base, ...inventory.base, 'README.md': BASELINE_README }

// ── 3. the bigger collision (ticket 4, second pass): seven tasks, five agents, one 359-line
// module full of look-alike lines (gap 3's edit-location errors), two producer/consumer
// chains (1 → 2 → 7), a cross-cutting rename (3: amt → amount, read by 5, 6 and 7), and two
// tasks that add a line at the same spot (4 and 5: the ACCOUNTS table, the validator stubs,
// the VALIDATORS list). BASE is flock-baseline@24397a5a plus these files, one seed commit. ──
const LEDGER_CORE = `"""A small household ledger: entries, accounts, validation and reports.

Amounts are whole cents (int). A negative amount is money leaving the account.
"""
from dataclasses import dataclass


@dataclass
class Entry:
    date: str
    account: str
    amt: int
    memo: str


ACCOUNTS = {
    "cash": {
        "kind": "asset",
        "currency": "USD",
        "limit": None,
    },
    "card": {
        "kind": "liability",
        "currency": "USD",
        "limit": None,
    },
    "checking": {
        "kind": "asset",
        "currency": "USD",
        "limit": None,
    },
    "rent": {
        "kind": "expense",
        "currency": "USD",
        "limit": None,
    },
    "food": {
        "kind": "expense",
        "currency": "USD",
        "limit": None,
    },
    "travel": {
        "kind": "expense",
        "currency": "USD",
        "limit": None,
    },
    "salary": {
        "kind": "income",
        "currency": "USD",
        "limit": None,
    },
    "gifts": {
        "kind": "income",
        "currency": "USD",
        "limit": None,
    },
}


# ── selecting entries ──


def debits(entries):
    """Entries that take money out."""
    out = []
    for e in entries:
        if e.amt < 0:
            out.append(e)
    return out


def credits(entries):
    """Entries that bring money in."""
    out = []
    for e in entries:
        if e.amt > 0:
            out.append(e)
    return out


def for_account(entries, account):
    """Entries on one account."""
    out = []
    for e in entries:
        if e.account == account:
            out.append(e)
    return out


def for_date(entries, date):
    """Entries on one day."""
    out = []
    for e in entries:
        if e.date == date:
            out.append(e)
    return out


def between(entries, start, end):
    """Entries from start to end, both included."""
    out = []
    for e in entries:
        if start <= e.date <= end:
            out.append(e)
    return out


def larger_than(entries, cents_):
    """Entries whose size is more than cents_."""
    out = []
    for e in entries:
        if abs(e.amt) > cents_:
            out.append(e)
    return out


def with_memo(entries, word):
    """Entries whose memo mentions word."""
    out = []
    for e in entries:
        if word in e.memo:
            out.append(e)
    return out


# ── summing entries ──


def total(entries):
    """The sum of every amount."""
    t = 0
    for e in entries:
        t += e.amt
    return t


def total_debits(entries):
    """The sum of the money going out (a negative number)."""
    t = 0
    for e in entries:
        if e.amt < 0:
            t += e.amt
    return t


def total_credits(entries):
    """The sum of the money coming in."""
    t = 0
    for e in entries:
        if e.amt > 0:
            t += e.amt
    return t


def count(entries):
    """How many entries there are."""
    t = 0
    for e in entries:
        t += 1
    return t


# ── picking one entry ──


def largest(entries):
    """The entry with the biggest size, or None."""
    if not entries:
        return None
    best = entries[0]
    for e in entries:
        if abs(e.amt) > abs(best.amt):
            best = e
    return best


def smallest(entries):
    """The entry with the smallest size, or None."""
    if not entries:
        return None
    best = entries[0]
    for e in entries:
        if abs(e.amt) < abs(best.amt):
            best = e
    return best


def first(entries):
    """The first entry, or None."""
    if not entries:
        return None
    return entries[0]


def last(entries):
    """The last entry, or None."""
    if not entries:
        return None
    return entries[-1]


def find(entries, memo):
    """The first entry with this memo, or None."""
    for e in entries:
        if e.memo == memo:
            return e
    return None


def find_on(entries, date):
    """The first entry on this day, or None."""
    for e in entries:
        if e.date == date:
            return e
    return None


# ── accounts ──


def account_kind(account):
    spec = ACCOUNTS.get(account)
    if spec is None:
        return None
    return spec["kind"]


def account_currency(account):
    spec = ACCOUNTS.get(account)
    if spec is None:
        return None
    return spec["currency"]


def account_limit(account):
    spec = ACCOUNTS.get(account)
    if spec is None:
        return None
    return spec["limit"]


# ── text ──


def cents(text):
    """'12.50' -> 1250, '-3' -> -300; None when text is not an amount."""
    text = text.strip()
    if not text:
        return None
    sign = -1 if text.startswith("-") else 1
    text = text.lstrip("+-")
    whole, _, frac = text.partition(".")
    if whole and not whole.isdigit():
        return None
    if frac and (not frac.isdigit() or len(frac) > 2):
        return None
    if not whole and not frac:
        return None
    return sign * (int(whole or "0") * 100 + int((frac + "00")[:2]))


def dollars(n):
    """1250 -> '12.50', -300 -> '-3.00'."""
    sign = "-" if n < 0 else ""
    n = abs(n)
    return "%s%d.%02d" % (sign, n // 100, n % 100)


def is_date(text):
    """True for a YYYY-MM-DD date with a real month and a day from 1 to 31."""
    parts = text.split("-")
    if len(parts) != 3:
        return False
    if not all(p.isdigit() for p in parts):
        return False
    if len(parts[0]) != 4:
        return False
    y, m, d = (int(p) for p in parts)
    if not 1 <= m <= 12:
        return False
    if not 1 <= d <= 31:
        return False
    return True


# ── validation ──


def check_date(entry):
    """A problem with the entry's date, or None."""
    if not is_date(entry.date):
        return "bad date"
    return None


def check_account(entry):
    """A problem with the entry's account, or None."""
    raise NotImplementedError


def check_amount(entry):
    """A problem with the entry's amount, or None."""
    raise NotImplementedError


def check_memo(entry):
    """A problem with the entry's memo, or None."""
    if len(entry.memo) > 40:
        return "memo too long"
    return None


VALIDATORS = [
    check_date,
    check_memo,
]


def validate(entry):
    """Every problem with one entry, in VALIDATORS order."""
    problems = []
    for check in VALIDATORS:
        p = check(entry)
        if p is not None:
            problems.append(p)
    return problems


# ── parsing and reports ──


def parse_entry(line):
    """One entry from a line of text."""
    raise NotImplementedError


def load(text):
    """Every entry in a block of text."""
    raise NotImplementedError


def balance(entries, account):
    """The sum of one account's amounts."""
    raise NotImplementedError


def monthly_totals(entries):
    """The sum of every month's amounts."""
    raise NotImplementedError


def format_entry(entry):
    """One entry as a report line."""
    raise NotImplementedError


def report(text):
    """A report of every entry in a block of text, with its total."""
    raise NotImplementedError
`
const LEDGER_TESTS = `from ledger.core import Entry, cents, debits, dollars, is_date, largest, total, validate


def es():
    return [Entry("2026-09-01", "cash", -150, "a"), Entry("2026-09-02", "card", 900, "b")]


def test_cents_and_dollars_round_trip():
    assert cents("12.50") == 1250 and cents("-3") == -300 and cents("x") is None
    assert dollars(1250) == "12.50" and dollars(-300) == "-3.00"


def test_is_date():
    assert is_date("2026-09-01") and not is_date("2026-13-01") and not is_date("nope")


def test_selecting_and_summing():
    assert [e.memo for e in debits(es())] == ["a"]
    assert total(es()) == 750
    assert largest(es()).memo == "b"


def test_a_good_entry_has_no_problems():
    assert validate(Entry("2026-09-01", "cash", -1250, "coffee")) == []
`
const ledger = {
  name: 'ledger',
  base: { ...inventory.base, 'ledger/__init__.py': '', 'ledger/core.py': LEDGER_CORE, 'tests/test_ledger.py': LEDGER_TESTS },
  check: ['python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider'],
  tasks: [
    { id: '1', title: 'Parse a ledger line', depends_on: [] },
    { id: '2', title: 'Load a ledger and balance an account', depends_on: ['1'] },
    { id: '3', title: 'Rename amt to amount', depends_on: [] },
    { id: '4', title: 'Account rules, and a savings account', depends_on: [] },
    { id: '5', title: 'Amount rules, and limits on cash and card', depends_on: [] },
    { id: '6', title: 'Monthly totals', depends_on: [] },
    { id: '7', title: 'Format an entry and print a report', depends_on: ['2'] },
  ],
}
fromPlan(ledger, '2026-09-25-flock-baseline-ledger.md')
WORKLOADS.ledger = ledger

// ── 4. ledger2 (ticket 4 follow-up): ledger, except task 4's validator is `check_known_account`
// (its BASE stub, its body and its probes renamed), so the intended VALIDATORS order
// (check_date, check_known_account, check_amount, check_memo) is NOT the merge's text order,
// which puts `    check_amount,` before `    check_known_account,`. Everything else is ledger's. ──
const KNOWN = (s) => s.replaceAll('check_account', 'check_known_account')
const ledger2 = {
  ...ledger,
  name: 'ledger2',
  base: { ...ledger.base, 'ledger/core.py': KNOWN(ledger.base['ledger/core.py']) },
  tasks: ledger.tasks.map((t) => ({ ...t, body: KNOWN(t.body), facts: t.facts.map((f) => f.map(KNOWN)) })),
}
WORKLOADS.ledger2 = ledger2

// ── 5. atlas (ticket 4, the scale pass, operator 2026-09-25): fifteen tasks for eight agents
// across six modules and their tests. Three producer→consumer chains three deep (1 → 2 → 14,
// 10 → 11 → 14, 4 → 6 → 7), a rename across six files (3: the Place field pop → population,
// read by 9 and 10, with a `words.pop(0)` that must survive it), a same-spot pair whose intended
// order is NOT the merge's text order (12 and 13: RULES wants check_range before check_country),
// hot files (index.py: 3, 8, 9; cli.py: 14, 15 both add to COMMANDS), and nine tasks ready at
// once. BASE is flock-baseline@520dd9d3 (its files below, byte for byte) plus these files, one
// seed commit that touches nothing that exists. ──
const MAIN_520 = {
  'README.md': `# flock-baseline

The starting code for the two Flock prototype workloads (map popmechanic/ultrapowers#1292, ticket 4), used as the target of today's factory for a like-for-like baseline.

- \`widgetkit/\`: the parser fixture (a constructor, a catalog that consumes it, size formatting).
- \`inventory/\`: built to collide (three tasks in one module).

Run the suite with \`python3 -m pytest -q\`.
`,
  '.gitignore': '__pycache__/\n.pytest_cache/\n*.pyc\n',
  'inventory/core.py': `from dataclasses import dataclass, replace
from typing import Optional

@dataclass
class Item:
    name: str
    quantity: int
    price: float
    sku: Optional[str] = None


def parse_line(line: str) -> Item:
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 3:
        raise ValueError("bad line")
    try:
        quantity = int(parts[1])
        price = float(parts[2])
    except ValueError:
        raise ValueError("bad line") from None
    sku = parts[3] if len(parts) > 3 else None
    return Item(parts[0], quantity, price, sku)


def total_value(items) -> float:
    return sum(item.quantity * item.price for item in items)


def load(text: str) -> list[Item]:
    return [parse_line(line) for line in text.splitlines() if line.strip()]


def restock(items, name, amount):
    if amount <= 0:
        raise ValueError("amount must be positive")
    if not any(item.name == name for item in items):
        raise KeyError(name)
    return [
        replace(item, quantity=item.quantity + amount) if item.name == name else item
        for item in items
    ]
`,
  'widgetkit/catalog.py': `"""The widget catalog: one widget per requested size, in request order."""

from widgetkit.widget import Widget, make_widget


def catalog(sizes: list[int]) -> list[Widget]:
    """Return one Widget per size in \`\`sizes\`\`, preserving order.

    Sizes are not validated here; an invalid size surfaces as the
    \`\`ValueError\`\` raised by \`\`make_widget\`\`.
    """
    return [make_widget(n) for n in sizes]
`,
  'widgetkit/format.py': `"""Human-readable formatting for widget sizes."""


def format_size(n: int) -> str:
    """Return a size in millimetres spelled out, e.g. \`\`format_size(3) == "3 mm"\`\`."""
    return f"{n} mm"
`,
  'widgetkit/widget.py': `"""The widget constructor."""

from dataclasses import dataclass


@dataclass
class Widget:
    size: int


def make_widget(n: int) -> Widget:
    """Return a Widget of size \`\`n\`\`; raise ValueError unless \`\`n\`\` is a positive whole number."""
    if isinstance(n, bool) or not isinstance(n, int) or n <= 0:
        raise ValueError("size must be positive")
    return Widget(size=n)
`,
}
const ATLAS_SEED = {
  'atlas/__init__.py': '',
  'atlas/places.py': `"""Places on the map: a name, a two-letter country code, a position in degrees and a head count."""
from dataclasses import dataclass


@dataclass
class Place:
    name: str
    country: str
    lat: float
    lon: float
    pop: int


def place_key(place):
    """How places sort: by country, then by name."""
    return (place.country, place.name)


def same_place(a, b):
    """True when a and b are the same place: the same country and the same name."""
    return place_key(a) == place_key(b)


def parse_place(line):
    """One place from a line of text."""
    raise NotImplementedError


def load_places(text):
    """Every place in a block of text."""
    raise NotImplementedError
`,
  'atlas/geo.py': `"""Distances and directions on a round Earth. A position is degrees: lat north, lon east."""
import math

EARTH_RADIUS_KM = 6371.0


def radians(deg):
    """Degrees to radians."""
    return deg * math.pi / 180


def degrees(rad):
    """Radians to degrees."""
    return rad * 180 / math.pi


def distance_km(a, b):
    """The great-circle distance from place a to place b, in kilometres."""
    raise NotImplementedError


def bearing_deg(a, b):
    """The compass bearing to set out on from place a towards place b, in degrees."""
    raise NotImplementedError
`,
  'atlas/routes.py': `"""Routes: places visited in order."""
from atlas.geo import distance_km
from atlas.places import same_place


def route_length(stops):
    """The distance of visiting the stops in order, in kilometres."""
    raise NotImplementedError


def nearest(origin, places):
    """The place closest to origin, other than origin itself."""
    raise NotImplementedError


def plan_route(start, places):
    """A route from start that always goes on to the closest place not yet visited."""
    raise NotImplementedError
`,
  'atlas/index.py': `"""Looking places up: by country, by name, by size."""
from atlas.places import place_key


def total_population(places):
    """How many people live in all of the places together."""
    t = 0
    for p in places:
        t += p.pop
    return t


def sorted_places(places):
    """The places in place_key order."""
    return sorted(places, key=place_key)


def by_country(places):
    """Every country's place names."""
    raise NotImplementedError


def search(places, prefix):
    """The places whose name starts with prefix."""
    raise NotImplementedError


def largest(places, n):
    """The n places where the most people live."""
    raise NotImplementedError
`,
  'atlas/render.py': `"""Text for people to read."""


def format_pop(place):
    """A place's head count, short: 709000 is '709k', 1250000 is '1.2M', 950 is '950'."""
    n = place.pop
    if n >= 1000000:
        return "%.1fM" % (n / 1000000)
    if n >= 1000:
        return "%dk" % (n // 1000)
    return str(n)


def wrap(text, width):
    """The words of text in lines no longer than width (a longer word gets a line of its own)."""
    words = text.split()
    lines = []
    line = ""
    while words:
        word = words.pop(0)
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = word if not line else line + " " + word
    if line:
        lines.append(line)
    return lines


def format_place(place):
    """One place as a table row."""
    raise NotImplementedError


def table(places):
    """Every place as a table row, with a total at the bottom."""
    raise NotImplementedError
`,
  'atlas/validate.py': `"""Checking that a place makes sense. Each rule answers a problem as text, or None."""


def check_name(place):
    """A problem with the place's name, or None."""
    if not place.name.strip():
        return "empty name"
    return None


def check_range(place):
    """A problem with the place's position, or None."""
    raise NotImplementedError


def check_country(place):
    """A problem with the place's country code, or None."""
    raise NotImplementedError


def check_people(place):
    """A problem with the place's head count, or None."""
    if place.pop < 0:
        return "negative population"
    return None


RULES = [
    check_name,
    check_people,
]


def validate(place):
    """Every problem with one place, in RULES order."""
    problems = []
    for rule in RULES:
        p = rule(place)
        if p is not None:
            problems.append(p)
    return problems
`,
  'atlas/cli.py': `"""The atlas command line: a command and its arguments, run over the places in a text."""
from atlas.places import load_places


def cmd_count(args, places):
    """How many places there are."""
    return str(len(places))


COMMANDS = {
    "count": cmd_count,
}


def main(argv, text):
    """Run the command argv[0], with the arguments argv[1:], over the places in text."""
    if not argv or argv[0] not in COMMANDS:
        return "unknown command"
    return COMMANDS[argv[0]](argv[1:], load_places(text))
`,
  'tests/test_atlas_places.py': `from atlas.places import Place, place_key, same_place
from atlas.validate import validate


def oslo():
    return Place("Oslo", "NO", 59.91, 10.75, pop=709000)


def test_place_key_sorts_by_country_then_name():
    b = Place("Bergen", "NO", 60.39, 5.32, pop=285000)
    s = Place("Stockholm", "SE", 59.33, 18.07, pop=984000)
    assert sorted([s, oslo(), b], key=place_key) == [b, oslo(), s]
    assert same_place(oslo(), oslo()) and not same_place(oslo(), b)


def test_a_good_place_has_no_problems():
    assert validate(oslo()) == []
`,
  'tests/test_atlas_geo.py': `import math

from atlas.geo import degrees, radians


def test_radians_and_degrees_round_trip():
    assert radians(180) == math.pi
    assert round(degrees(radians(59.91)), 9) == 59.91
`,
  'tests/test_atlas_render.py': `from atlas.index import total_population
from atlas.places import Place
from atlas.render import format_pop, wrap


def test_format_pop():
    assert format_pop(Place("a", "NO", 0, 0, pop=709000)) == "709k"
    assert format_pop(Place("b", "NO", 0, 0, pop=1250000)) == "1.2M"
    assert format_pop(Place("c", "NO", 0, 0, pop=950)) == "950"


def test_total_population():
    assert total_population([Place("a", "NO", 0, 0, pop=1), Place("b", "SE", 0, 0, pop=2)]) == 3


def test_wrap():
    assert wrap("a bb ccc dddd", 6) == ["a bb", "ccc", "dddd"]
`,
}
const atlas = {
  name: 'atlas',
  base: { ...ledger.base, ...MAIN_520, ...ATLAS_SEED },
  check: ['python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider'],
  tasks: [
    { id: '1', title: 'Parse a place', depends_on: [] },
    { id: '2', title: 'Load places', depends_on: ['1'] },
    { id: '3', title: 'Rename pop to population', depends_on: [] },
    { id: '4', title: 'Distance between two places', depends_on: [] },
    { id: '5', title: 'Bearing from one place to another', depends_on: [] },
    { id: '6', title: 'Route length and the nearest place', depends_on: ['4'] },
    { id: '7', title: 'Plan a route', depends_on: ['6'] },
    { id: '8', title: 'Places by country, and search by name', depends_on: [] },
    { id: '9', title: 'The largest places', depends_on: [] },
    { id: '10', title: 'Format a place', depends_on: [] },
    { id: '11', title: 'A table of places', depends_on: ['10'] },
    { id: '12', title: 'Position rule', depends_on: [] },
    { id: '13', title: 'Country rule', depends_on: [] },
    { id: '14', title: 'The list command', depends_on: ['2', '11'] },
    { id: '15', title: 'The dist command', depends_on: ['2', '4'] },
  ],
}
fromPlan(atlas, '2026-09-25-flock-baseline-atlas.md')
WORKLOADS.atlas = atlas

// ── 6. runroom (operator 2026-09-26, the pre-registered A/B on #1292): the signed Run Room plan,
// twelve tasks, run like-for-like against the factory's runroom run-1. BASE is
// popmechanic/runroom@d28312f2, read byte for byte from the local clone; the run-wide check is the
// plan's own three `Check:` lines. A TypeScript workload: `setup` installs once, and the host links
// the installed node_modules into every copy (host.mjs, linkDeps). ──
import { spawnSync as spawnSyncW } from 'node:child_process'
import os from 'node:os'
const RUNROOM_REPO = process.env.RUNROOM_REPO ?? path.join(os.homedir(), 'Websites', 'runroom')
const RUNROOM_BASE = 'd28312f2bbf03d7a1881754912c3423f49442a96'
function treeAt (repo, sha) {
  const ls = spawnSyncW('git', ['-C', repo, 'ls-tree', '-r', '-z', '--name-only', sha], { encoding: 'utf8' })
  if (ls.status !== 0) throw new Error(`git ls-tree ${sha} in ${repo}: ${ls.stderr}`)
  const out = {}
  for (const p of ls.stdout.split('\0').filter(Boolean)) {
    out[p] = spawnSyncW('git', ['-C', repo, 'show', `${sha}:${p}`], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout
  }
  return out
}
try {
  const planText = fs.readFileSync(path.join(HERE_W, 'plans', '2026-09-26-run-room.md'), 'utf8')
  const checks = [...planText.matchAll(/^- Check: (.*)$/gm)].map((m) => m[1])
  const runroom = {
    name: 'runroom',
    base: treeAt(RUNROOM_REPO, RUNROOM_BASE),
    check: ['bash', '-lc', checks.join(' && ')],
    setup: ['bun', 'install', '--frozen-lockfile'],
    tasks: [
      { id: '1', title: 'The GitHub reader', depends_on: [] },
      { id: '2', title: 'The plan parser', depends_on: [] },
      { id: '3', title: 'The event digester', depends_on: [] },
      { id: '4', title: 'The scan loop', depends_on: [] },
      { id: '5', title: 'The run list', depends_on: [] },
      { id: '6', title: 'The run header', depends_on: [] },
      { id: '7', title: 'The task timeline', depends_on: [] },
      { id: '8', title: 'The step detail', depends_on: [] },
      { id: '9', title: 'The checks strip', depends_on: [] },
      { id: '10', title: 'The empty-fleet and legacy states', depends_on: [] },
      { id: '11', title: 'The Durable Object wiring', depends_on: ['1', '2', '3', '4'] },
      { id: '12', title: 'The app shell', depends_on: ['5', '6', '7', '8', '9', '10'] },
    ],
  }
  fromPlan(runroom, '2026-09-26-run-room.md')
  WORKLOADS.runroom = runroom
} catch (e) {
  if (process.env.FLOCK_DEBUG) console.error('runroom workload unavailable:', e.message)
}
