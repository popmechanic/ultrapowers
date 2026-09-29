# The catch-up meets a red check: a run whose check breaks on the moved main holds back

**Grammar:** claims-v1
**Claim:** When a run's check passes on its own base but fails once it is caught up to the moved main, the run stops short of merging, its pull request stays open, and its status says the catch-up went red. (elicited)
**Summary:** This is a deliberate test run carrying a check that is true on its starting point and false on today's main. It exists because the engine's step that re-checks a run on a newer main has never failed a check outside a simulation. You find out, on the real fleet, whether a run whose checks break on the new main holds back instead of merging.

**Goal:** Exercise `factory/flock/catchup.mjs`'s red path live (map #1292, the 2026-09-29 first-live-catch-up comment): launched on `8dd30474`, the run edits only `README.md`, which main has not changed since, so the join is clean; the run-wide tripwire check below reads the plugin version `0.3.42`, true at the base and false on main (`0.3.43`), so the catch-up's re-run check must answer `red` and park with the pull request open.
**Tech Stack:** Markdown
**Spec:** none — operator pick 2026-09-29 (reap, then prove catch-up)

## Global Constraints

- The tripwire below is deliberate: it is green on the run's own base and red on main after the 0.3.43 release, and it is the whole point of this plan. No task edits either manifest.
- Check: grep -q '"version": "0.3.42"' .claude-plugin/plugin.json

### Task 1: The README says what happens when main moves during a run

**Type:** implementation

**Files:**
- Modify: `README.md`

**Claim:** The README tells a reader what happens when main moves while a run is working, and names the file that does it. (elicited)
Machine: M1. `README.md` names `factory/flock/catchup.mjs`. M2. The `## How it works` paragraph that says the sandbox opens the pull request goes on to say that when main has moved, the sandbox joins the run's work onto the new main and re-runs the plan's probes and checks there before merging, and that a conflict or a red check leaves the pull request open and unmerged.

**Authorized-by:** operator pick 2026-09-29; map #1292 (the first live catch-up, 2026-09-29 comment)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The paragraph is the first under `## How it works`; it ends "opens the pull request on the repository you ran in — ready if its own checks ended green, a draft otherwise — with the evidence linked in its body." Add one or two plain sentences after it, in the README's reader-facing register: if main moved while the run worked, the sandbox first joins the run's work onto the new main (`factory/flock/catchup.mjs`) and re-runs the plan's probes and checks there; only then does it merge its own pull request, and a conflict or a red check leaves that pull request open and unmerged for you. Edit nothing else in the file.

**Proof:**
- Run: grep -q 'factory/flock/catchup.mjs' README.md [M1]
- Legs: (a) `README.md` contains the path `factory/flock/catchup.mjs` [M1]; M2's wording is read against the hunk at landing [M2].

**Stale-if:**
- path-absent: `factory/flock/catchup.mjs`
