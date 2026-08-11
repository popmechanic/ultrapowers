# Review-packet branch naming (#130)

_Spec 2026-08-10. One plan, one docket entry. Script + tests only — smaller
than triaged: exploration showed no harness, prompt, or Python consumer of
the packet's sha-pair filename, so no waves.js edit, no re-bake, no `.mjs`
sim obligation._

## Problem

Field 2026-08-09 (run `wf_fe05bc69-a22`): Task 1's first attempt produced a
contaminated commit (`bb969e6` — carried unrelated changes AND deleted the
plan/spec under execution); the redo was correct and became the branch tip.
But the packet on disk, `review-d796ce6..bb969e6.diff` (211KB), still named
the contaminated sha — which no branch contained. A retry trusting the
packet filename over the branch tip would have merged the wrong tree; the
merge agent and completeness critic each had to discover the trap
independently. Sha-pair names make every redo *accrete* a stale packet.

## Ground truth (verified at brainstorm)

- `review-package BASE HEAD [OUTFILE]` writes
  `review-<base7>..<head7>.diff` by default; the packet **content** header
  is `# Review package: ${base}..${head}` with full shas.
- The reviewer's baked instruction reads the packet at the *echoed path*
  the implementer reports, and its guarded fallback keys on the packet's
  **recorded HEAD vs the implementer HEAD** — a content check, not a
  filename check.
- Consumers of the sha-pair *name*: the script's own `default_name()` and
  one assertion (`tests/test_review_package.py:146`). Nothing else in
  skills/, harnesses/, or tests/ globs or parses it.

## Design (issue option b — derive-don't-record, the inexpressible shape)

`default_name()` derives from the current branch instead of the sha pair:

- `review-<sanitized-branch>.diff`, sanitization mapping every character
  outside `[A-Za-z0-9._-]` to `-`
  (`ultra/task-3-fix` → `review-ultra-task-3-fix.diff`).
- Branch detection MUST be `git branch --show-current` — exit 0 with empty
  output on detached HEAD, and per-worktree correct in linked worktrees.
  (`git symbolic-ref --short HEAD` exits 128 when detached and, in the
  assignment form, would kill the script under its `set -euo pipefail`; the
  existing `test_packet_dir_shared_across_worktrees` runs the script in a
  detached worktree, so the wrong idiom fails the current suite
  immediately.)
- A redo on the same branch produces the same filename and **overwrites its
  predecessor**. Which redo shape this kills, precisely: the same-branch
  history rewrite (an implementer's in-session amend/reset — exactly the
  incident's shape), the only shape that can leave a packet naming a sha
  **no branch contains**. Engine-level fix rounds dispatch on a *fresh*
  engine-assigned branch (waves.js fix loop), so their packets still
  accrete one-per-branch — deliberately untouched, and harmless: each such
  packet is branch-consistent (names a sha its branch still contains).
- Filename collisions between live branches (characters that both map to
  `-`, e.g. `a/b` vs `a+b`; a branch literally named `a-b`; or case-folding
  on default-case-insensitive macOS filesystems, `Foo` vs `foo`) degrade
  gracefully, not silently wrong: the later write wins, and the reviewer's
  recorded-HEAD-mismatch fallback recovers the true diff read-only via
  `git diff BASE HEAD`. (The content header echoes the caller's arguments
  verbatim — the engine passes shas; the header being shas is a caller
  property, not a script guarantee, and a non-matching header string routes
  to the same fallback either way.)
- Overwrite destroys the predecessor packet — including, in the incident's
  shape, the contaminated first attempt's forensic diff. Accepted: no
  consumer reads old packets (verified across audit, finalize, viewer,
  sweep), and packets are regenerable from git at any time.
- **Detached HEAD** (empty `--show-current` output — not the
  implementer-worktree case, but the script is general and the shared-dir
  test runs it detached): fall back to today's sha-pair name unchanged.
- The content header keeps the full `base..head` shas exactly as today, so
  the reviewer's recorded-HEAD fallback check is untouched and still
  catches the residual case (a crashed redo that never regenerated its
  packet).
- The explicit-OUTFILE and trailing-slash directory forms are unchanged in
  behavior; the directory form receives the new default name.
- The script's usage comment block updates to describe the branch-derived
  default and the detached fallback (same file, no other doc surface names
  the packet filename).

## Testing

In `tests/test_review_package.py`:

- Update the existing default-name assertion (line 146) to the
  branch-derived name.
- New: same-branch redo overwrites — two invocations with different HEADs,
  one file on disk afterward, content carries the second head.
- New: slashed/odd-character branch name sanitized
  (`ultra/task_3+x` → `review-ultra-task_3-x.diff`).
- New: detached HEAD falls back to the sha-pair name.

## Out of scope

- No migration or cleanup of pre-existing sha-named packets: the reviewer's
  head-match check already defends reads, and cleanup already exists — the
  SKILL gate step removes the run's review dir, and `ultra_run.py`'s
  keep-10 run-dir prune is the backstop (the worktree sweep never touches
  scratch — a first-draft misattribution the trim review corrected).
- The issue's secondary question — how a contaminated first attempt
  committed unrelated files at all (implementer worktree hygiene) — stays a
  watch-item, not scope.
- No harness, prompt, or gate changes; frozen periphery untouched.

## Acceptance

**Acceptance:** suite — a bash script and its committed pytest coverage;
`tests/*.mjs` sims are not implicated (no `harnesses/*.js` change, so the
suite-gate JS guard stays unarmed by construction).

## Complexity accounting

Changes one function and one comment block in one script; adds three test
cases; deletes the accreting-stale-packet failure shape. Zero new files,
knobs, or guards. `complexityEffect: structural` (the docket entry's
triage framing: not a guard — does not consume the cycle's guard slot).

## Trim review

**Author disclosure (Adds/Removes).** Adds: branch-derived `default_name()`
with a detached sha-pair fallback, three test cases. Removes: the
sha-pair default name and the accreting-stale-packet failure shape. No
surface beyond the script and its test file.

### Round 1

Fresh-context subagent (seal-author independence model); verified the
script, its test file, all candidate filename consumers, and the engine's
fix-loop redo semantics. Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| U1 | FALSE attribution: "worktree sweeps clean scratch" — sweep never touches scratch; real cleanup = SKILL gate step rm + ultra_run keep-10 prune | **Adopted** — Out of scope corrected |
| U2 | Redo semantics overstated: engine fix rounds use fresh branches, so their packets still accrete (branch-consistent, harmless); the overwrite kills exactly the same-branch-rewrite shape — the incident's | **Adopted** — design states which shape it fixes and which it leaves as exhaust |
| U3 | Branch-detection idiom unnamed; `symbolic-ref` dies under pipefail on the existing detached-worktree test | **Adopted** — `git branch --show-current` mandated, with the why |
| U4 | Sanitization collisions under same-wave concurrency unexamined | **Adopted** — graceful-degradation sentence (later write wins; head-match fallback recovers read-only) |
| U5 | Audit-trail loss (overwrite destroys the forensic first-attempt packet) unacknowledged | **Adopted** — accepted with the no-consumer verification stated |

Trims proposed: none — "the spec is already near-minimal"; the
detached-HEAD fallback is load-bearing (an existing test runs the script
detached). Rejections: none. Scope: within the issue and narrower (no
validation, no `.stale`, no migration).

**Round-1 reviewer grade: `netConceptDelta = flat`** — one concept added
(two-regime naming), one removed (stale packets accrete; trust the tip
over the filename).

**Round-1 marginal value:** one artifact-changing finding (U3 — the
pipefail-safe idiom, else the first implementation fails the existing
suite); the rest spec-text accuracy and safety confirmation.

### Round 2 (second independent reviewer — the diminishing-returns check)

Fresh-context subagent; traced every claim to ground, including empirical
checks of the sanitizer example and both git idioms' exit behavior, the
waves.js fix-loop fresh-branch claim, and both cleanup mechanisms.
Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| F1 | `symbolic-ref` exits 128 (not 1) when detached; kill-the-script consequence holds in the assignment form | **Adopted** — wording corrected |
| F2 | "Full shas" in the header is a caller property, not a script guarantee (the header echoes arguments verbatim) | **Adopted** — stated with the fallback-either-way consequence |
| U-a | Collision acknowledgment named only one of three modes (literal `a-b`; macOS case-folding) | **Adopted** — widened, same degradation |
| T1 | `/`-callout redundant with the char class | **Adopted** — dropped |

Rejections: none. All round-1 absorptions verified to compose with the
code; all three new tests confirmed implementable in the test file's
existing fixture style; scope confirmed narrower than the issue.

**Round-2 reviewer grade: `netConceptDelta = flat`** — concurring with
round 1.

**Stopping decision (author, applying the pre-declared rule):** diminishing
returns reached — round 2's own assessment: "zero findings change the
built artifact … the spec is build-ready." Two rounds, 9 findings, all
adopted, 0 rejected; grades: flat ×2.
