# Plan: Unmarked Fixture

> Exercises the classification heuristics, the marker-conflict path, and
> fence-aware splitting. Only Task 5 carries a marker — a deliberately wrong
> `Depends-on: none` that the file edge must override.

**Acceptance:** waived — compiler test fixture

---

### Task 1: Create alpha

**Files:**
- Create: `a.txt`

- [ ] **Step 1:** Write `alpha` to `a.txt`. The plan format embeds examples:

```markdown
### Task 99: this heading is fenced content, not a task
```

### Task 2: Edit alpha

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Append `beta` to `a.txt`.

### Task 3: Publish

**Files:**
- Modify: `plugin.json`

- [ ] **Step 1:** Bump the version, commit, and `git push origin main`.

### Task 4: Suite gate

**Files:** none (verification only)

- [ ] **Step 1:** Run: `pytest -q` — expect all green.

### Task 5: Rewrite alpha

**Depends-on:** none

**Files:**
- Modify: `a.txt`

- [ ] **Step 1:** Replace the contents of `a.txt` with `gamma`.
