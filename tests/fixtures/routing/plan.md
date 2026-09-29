# Routing Fixture Plan

**Grammar:** claims-v1

**Acceptance:** waived — plan_check fixture; this plan is checked, never executed

**Claim:** An operator checking this plan is shown the route it recommends. (elicited)

**Goal:** A three-task claims-v1 plan whose launch waves are `[[1, 2], [3]]`: task 1
Produces the widget constructor, task 3 Consumes it, task 2 is independent of both.

---

### Task 1: The widget constructor

**Type:** implementation

**Files:**
- Create: `widgetkit/widget.py`

**Claim:** An operator asks for a widget of a given size and gets one back. (elicited)
Machine: M1. `make_widget(3)` returns a `Widget` whose `size` is `3`.

**Authorized-by:** routing fixture

**Interfaces:**
- Consumes: nothing
- Produces: `make_widget(n: int) -> Widget`

**Context:** `Widget` is a new dataclass carrying one field, `size: int`.

**Proof:**
- Run: python3 -c "import widgetkit.widget" [M1]

**Stale-if:**
- path-exists: `tests/fixtures/routing/never-there.md`

### Task 2: Size formatting

**Type:** implementation

**Files:**
- Create: `widgetkit/format.py`

**Claim:** An operator reading a size sees millimetres spelled out. (elicited)
Machine: M1. `format_size(3)` returns `"3 mm"`.

**Authorized-by:** routing fixture

**Interfaces:**
- Consumes: nothing
- Produces: `format_size(n: int) -> str`

**Context:** Formatting takes an integer, not a `Widget`.

**Proof:**
- Run: python3 -c "import widgetkit.format" [M1]

**Stale-if:**
- path-exists: `tests/fixtures/routing/never-there.md`

### Task 3: The widget catalog

**Type:** implementation

**Files:**
- Create: `widgetkit/catalog.py`

**Claim:** An operator lists the sizes they want and gets one widget per size. (elicited)
Machine: M1. `catalog([1, 3])` returns two `Widget`s whose sizes are `[1, 3]`.

**Authorized-by:** routing fixture

**Interfaces:**
- Consumes: `make_widget(n: int) -> Widget`
- Produces: `catalog(sizes: list[int]) -> list[Widget]`

**Context:** The catalog is a thin mapping over the constructor.

**Proof:**
- Run: python3 -c "import widgetkit.catalog" [M1]

**Stale-if:**
- path-exists: `tests/fixtures/routing/never-there.md`
