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
  }
}
fromPlan(widgetkit, '2026-09-25-flock-baseline-widgetkit.md')
fromPlan(inventory, '2026-09-25-flock-baseline-inventory.md')
// and both start from the same BASE the fleet does: flock-baseline@24397a5a holds both packages
const BASELINE_README = '# flock-baseline\n'
widgetkit.base = inventory.base = { ...widgetkit.base, ...inventory.base, 'README.md': BASELINE_README }
