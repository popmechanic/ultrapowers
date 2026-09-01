# Widget Kit Implementation Plan

**Grammar:** claims-v1

**Acceptance:** waived — compiler fixture; this plan is compiled, never executed

**Goal:** A three-task claims-v1 sample: one task Produces the widget constructor,
one Consumes it, one is independent of both. Every task carries all six body slots,
predicate Stale-ifs, and a provenance tag — the shape the `claims-v1` compiler mode
is specified against (spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3).

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q`
from the repo root.

---

### Task 1: The widget constructor

**Type:** implementation

**Files:**
- Create: `widgetkit/widget.py`
- Test: `tests/test_widget.py`

**Claim:** An operator asks for a widget of a given size and gets one back, or a clear
error when the size is not a positive whole number. (quoted from #489)
Machine: `make_widget(3)` returns a `Widget` whose `size` is `3`; `make_widget(0)` and
`make_widget(-1)` each raise `ValueError("size must be positive")`.

**Authorized-by:** #489; spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `make_widget(n: int) -> Widget`

**Context:** `widgetkit/` is a flat package with no registry and no `__init__` exports to
update. `Widget` is a new dataclass carrying one field, `size: int`.

**Proof:**
- Test: `tests/test_widget.py`

```python
assert make_widget(3).size == 3
with pytest.raises(ValueError):
    make_widget(0)
```

**Stale-if:**
- path-exists: `widgetkit/widget.py`
- issue-closed: #489

### Task 2: The widget catalog

**Type:** implementation

**Files:**
- Create: `widgetkit/catalog.py`
- Test: `tests/test_catalog.py`

**Claim:** An operator lists the sizes they want and gets one widget per size, in the
order they asked. (elicited)
Machine: `catalog([1, 3])` returns a list of two `Widget`s whose `size` values are
`[1, 3]`; `catalog([])` returns `[]`.

**Authorized-by:** #489; spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3

**Interfaces:**
- Consumes: `make_widget(n: int) -> Widget`
- Produces: `catalog(sizes: list[int]) -> list[Widget]`

**Context:** The catalog is a thin mapping over the constructor — it neither validates
sizes itself nor caches, so an invalid size surfaces as the constructor's own
`ValueError`.

**Proof:**
- Test: `tests/test_catalog.py`

```python
assert [w.size for w in catalog([1, 3])] == [1, 3]
assert catalog([]) == []
```

**Stale-if:**
- path-exists: `widgetkit/catalog.py`
- issue-closed: #489

### Task 3: Size formatting

**Type:** implementation

**Files:**
- Create: `widgetkit/format.py`
- Test: `tests/test_format.py`

**Claim:** An operator reading a size in a report sees millimetres spelled out rather
than a bare number. (elicited)
Machine: `format_size(3)` returns `"3 mm"`; `format_size(0)` returns `"0 mm"`.

**Authorized-by:** #489; spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3

**Interfaces:**
- Consumes: nothing
- Produces: `format_size(n: int) -> str`

**Context:** Formatting is independent of the constructor and the catalog: it takes an
integer, not a `Widget`, so it shares no symbol and no file with either.

**Proof:**
- Test: `tests/test_format.py`

```python
assert format_size(3) == "3 mm"
assert format_size(0) == "0 mm"
```

**Stale-if:**
- path-exists: `widgetkit/format.py`
- issue-closed: #489
