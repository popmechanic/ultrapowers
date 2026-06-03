# Plan: Canary Fixture

> Tiny fixture for validating ultrapowers' dependency analysis and wave computation.

**Goal:** Two independent tasks plus one dependent task, so the expected wave grouping is known: `[[Task A, Task B], [Task C]]` with edge `A → C`.

---

### Task A: Create alpha

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to `a.txt`.

### Task B: Create beta

**Files:**
- Create: `b.txt`

- [ ] **Step 1:** Write `beta` to `b.txt`.

### Task C: Append to alpha

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Append `gamma` to `a.txt`. Depends on Task A (Task A creates the file this task modifies).
