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
