<!-- Moved out of ultrawrite's SKILL.md to keep it under 500 lines. -->

# A complete task, every slot filled

```markdown
### Task 2: The widget catalog

**Type:** implementation

**Files:**
- Create: `widgetkit/catalog.py`

**Claim:** An operator lists the sizes they want and gets one widget per size, in the
order they asked. (quoted from #489)
Machine: M1. `catalog([1, 3])` returns two `Widget`s whose `size` values are `[1, 3]`.
M2. `catalog([])` returns an empty list.

**Authorized-by:** #489; spec `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md` §3

**Interfaces:**
- Consumes: `make_widget(n: int) -> Widget`
- Produces: `catalog(sizes: list[int]) -> list[Widget]`

**Context:** The catalog is a thin mapping over the constructor — it neither validates
sizes nor caches, so a bad size surfaces as the constructor's own `ValueError`.

**Proof:**
- Run: python3 -c "from widgetkit.catalog import catalog; ws = catalog([1, 3]); assert [w.size for w in ws] == [1, 3] and len(ws) == 2" [M1]
- Run: python3 -c "from widgetkit.catalog import catalog; assert catalog([]) == []" [M2]
- Legs: (a) `catalog([1, 3])` yields exactly two widgets with sizes `[1, 3]` in that
  order [M1]; (b) `catalog([])` is exactly `[]` [M2].

**Stale-if:**
- path-absent: `widgetkit/widget.py`
```
