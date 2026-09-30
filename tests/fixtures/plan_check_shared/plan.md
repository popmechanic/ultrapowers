# Shared-file probe

**Grammar:** claims-v1

**Claim:** A plan whose tasks share a file is told so. (elicited)
**Summary:** Two tasks list one file. The checker names it in a SHARED fact line (n=1 run, 2026-09-29). So each task is asked for a keep-probe.

**Goal:** Show the SHARED fact line.
**Closes:** #1
**Tech Stack:** Python 3.

---

### Task 1: Task 1

**Type:** implementation

**Files:**
- Modify: `a.txt`

**Claim:** Task 1 edits a.txt. (derived)
Machine: M1. `true` exits 0.

**Authorized-by:** operator decisions 2026-09-29 (fixture)

**Interfaces:** Consumes: none; Produces: none

**Context:** Nothing to build; the Files are the point.

**Proof:**
- Run: true [M1]
- Legs: (a) true exits 0 [M1].

**Stale-if:** path-exists: `tests/fixtures/plan_check_shared/never-there.md`

### Task 2: Task 2

**Type:** implementation

**Files:**
- Modify: `a.txt`

**Claim:** Task 2 edits a.txt. (derived)
Machine: M1. `true` exits 0.

**Authorized-by:** operator decisions 2026-09-29 (fixture)

**Interfaces:** Consumes: none; Produces: none

**Context:** Nothing to build; the Files are the point.

**Proof:**
- Run: true [M1]
- Legs: (a) true exits 0 [M1].

**Stale-if:** path-exists: `tests/fixtures/plan_check_shared/never-there.md`

### Task 3: Task 3

**Type:** implementation

**Files:**
- Modify: `b.txt`

**Claim:** Task 3 edits b.txt. (derived)
Machine: M1. `true` exits 0.

**Authorized-by:** operator decisions 2026-09-29 (fixture)

**Interfaces:** Consumes: none; Produces: none

**Context:** Nothing to build; the Files are the point.

**Proof:**
- Run: true [M1]
- Legs: (a) true exits 0 [M1].

**Stale-if:** path-exists: `tests/fixtures/plan_check_shared/never-there.md`
