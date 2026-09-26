# Flock baseline: widgetkit through today's factory

**Grammar:** claims-v1

**Claim:** I open the merged pull request on flock-baseline and a widget can be made at a given size, a list of sizes gives back a catalog of widgets in order, and a size prints in millimetres, with every check green. (elicited)
**Summary:** This runs the three small widgetkit tasks through today's factory on the fleet, the same work the laptop Flock prototype already did. It exists to give the Flock a fair comparison: the same tasks, the same checks, the same model, one system against the other. You get a measured answer to whether a leaderless swarm is faster or cheaper than the factory we run now.

**Goal:** A like-for-like baseline for map popmechanic/ultrapowers#1292 ticket 4: the widgetkit workload's three tasks, with the prototype's own fact commands as each task's probes.

**Tech Stack:** Python 3 + pytest. Run the suite with `python3 -m pytest -q -p no:cacheprovider` from the repository root.

Spec: popmechanic/ultrapowers#1292 (the Flock map) and its ticket 4 scope comment.

## Global Constraints

- Check: python3 -m pytest -q -p no:cacheprovider
- The package stays flat: no registry, and no exports added to `widgetkit/__init__.py`.

---

### Task 1: The widget constructor

**Type:** implementation

**Files:**
- Create: `widgetkit/widget.py`

**Claim:** An operator asks for a widget of a given size and gets one back, or a clear error when the size is not a positive whole number. (derived)
Machine: M1. `make_widget(3)` returns a `Widget` whose `size` is `3`. M2. `make_widget(0)` and `make_widget(-1)` each raise `ValueError` whose message is exactly `size must be positive`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4 (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `make_widget(n: int) -> Widget`

**Context:** `widgetkit/` is a flat package with no registry and no `__init__` exports to update. `Widget` is a new dataclass carrying one field, `size: int`, defined in `widgetkit/widget.py` beside `make_widget`.

**Proof:**
- Run: python3 -c "from widgetkit.widget import make_widget; assert make_widget(3).size == 3" [M1]
- Run: python3 -c "import pytest; from widgetkit.widget import make_widget; [pytest.raises(ValueError, make_widget, n).match('^size must be positive$') for n in (0, -1)]" [M2]
- Legs: (a) `make_widget(3).size` is exactly `3` [M1]; (b) both `0` and `-1` raise `ValueError` with the exact message, and a size that raised nothing would fail the probe [M2].

**Stale-if:**
- path-exists: `widgetkit/widget.py`

### Task 2: The widget catalog

**Type:** implementation

**Files:**
- Create: `widgetkit/catalog.py`

**Claim:** An operator lists the sizes they want and gets one widget per size, in the order they asked. (derived)
Machine: M1. `catalog([1, 3])` returns a list of two `Widget`s whose `size` values are `[1, 3]`, in that order. M2. `catalog([])` returns `[]`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4 (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: `make_widget(n: int) -> Widget`
- Produces: `catalog(sizes: list[int]) -> list[Widget]`

**Context:** The catalog is a thin mapping over `make_widget(n: int) -> Widget` from `widgetkit/widget.py`: it neither validates sizes nor catches, so an invalid size surfaces as the constructor's own `ValueError`.

**Proof:**
- Run: python3 -c "from widgetkit.catalog import catalog; ws = catalog([1, 3]); assert [w.size for w in ws] == [1, 3]" [M1]
- Run: python3 -c "from widgetkit.catalog import catalog; assert catalog([]) == []" [M2]
- Legs: (a) `catalog([1, 3])` yields sizes exactly `[1, 3]`, so a wrong count or order fails [M1]; (b) `catalog([])` is exactly `[]` [M2].

**Stale-if:**
- path-exists: `widgetkit/catalog.py`

### Task 3: Size formatting

**Type:** implementation

**Files:**
- Create: `widgetkit/format.py`

**Claim:** An operator reading a size in a report sees millimetres spelled out rather than a bare number. (derived)
Machine: M1. `format_size(3)` returns exactly `"3 mm"` and `format_size(0)` returns exactly `"0 mm"`.

**Authorized-by:** popmechanic/ultrapowers#1292 ticket 4 (operator's pick, 2026-09-25)

**Interfaces:**
- Consumes: nothing
- Produces: `format_size(n: int) -> str`

**Context:** Formatting is independent of the constructor and the catalog: `format_size` takes an integer, not a `Widget`, and shares no symbol and no file with either.

**Proof:**
- Run: python3 -c "from widgetkit.format import format_size; assert format_size(3) == '3 mm' and format_size(0) == '0 mm'" [M1]
- Legs: (a) both strings are byte-exact, so a missing space or unit fails [M1].

**Stale-if:**
- path-exists: `widgetkit/format.py`
