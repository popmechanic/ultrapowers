# Widget Size Plan

**Grammar:** claims-v1

**Claim:** Every widget answers its size. (quoted from #1)

**Acceptance:** waived — provenance fixture; this plan is resolved, never executed

**Goal:** A one-task claims-v1 sample whose header quotes an issue, for `check_provenance.py`.

---

### Task 1: The widget size

**Type:** implementation

**Files:**
- Create: `widgetkit/widget.py`

**Claim:** `Widget(3).size` is `3`. (derived)
Machine: `Widget(3).size == 3`.

**Authorized-by:** #1

**Interfaces:**
- Consumes: nothing
- Produces: `Widget(n: int)`

**Context:** `widgetkit/` is a flat package; `Widget` is a new dataclass with one field, `size: int`.

**Proof:**
- Run: `python3 -c "from widgetkit.widget import Widget; assert Widget(3).size == 3"`

**Stale-if:**
- path-exists: `widgetkit/widget.py`
