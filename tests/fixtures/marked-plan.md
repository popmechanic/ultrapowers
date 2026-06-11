# Plan: Marked Fixture

> Tiny fixture for validating marker parsing, classification, and runbook
> extraction. Expected compile: waves `[[Task 1, Task 2], [Task 3]]` with edge
> `1 → 3` (marker AND write-after-create agree); Task 4 → gate (compiled into run
> config); Task 5 → release (post-merge runbook). Task 2 has no `Type:` marker on
> purpose — it must default to `implementation`.

---

### Task 1: Create alpha

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to `a.txt`.

### Task 2: Create beta

**Depends-on:** none

**Files:**
- Create: `b.txt`

- [ ] **Step 1:** Write `beta` to `b.txt`.

### Task 3: Append to alpha

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Append `gamma` to `a.txt`.

### Task 4: Suite gate

**Type:** gate

**Files:** none (verification only)

- [ ] **Step 1:** Run: `pytest -q` — expect all green.

### Task 5: Publish

**Type:** release

**Files:**
- Modify: `plugin.json`

- [ ] **Step 1:** Bump the version, commit, and `git push origin main`.

(End of fixture.)
