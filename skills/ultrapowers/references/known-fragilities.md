# Known fragilities

Latent risks that are not currently failing but are worth tracking. Each entry
records the risk, why it does not bite today, and what would change that.

## Review packets live under `.git/ultra/`

`skills/ultrapowers/scripts/review-package` writes each task's review diff to
`$(git rev-parse --git-common-dir)/ultra/…`, i.e. **inside `.git/`**, so the
implementer and reviewer worktrees (different linked worktrees) share one location.

This is the same protected path superpowers fled in **6.0.3**: Claude Code treats
`.git/` as a protected path and denies *file-write-tool* writes there, which was
blocking superpowers' SDD subagents (it relocated its scratch to `.superpowers/sdd/`).

**Why it does not bite ultrapowers today:** ultrapowers writes the packet via a
Bash script with shell redirection (`> "$out"`), which is not intercepted the way
the Write/Edit file tools are. Empirically `.git/ultra/` accumulates packets across
runs and a write probe succeeds.

**What would change that:** if Claude Code tightens `.git/` protection to cover
Bash-tool writes, or on a surface that already does, the reviewer step would lose
its packet. The fix would be to relocate ultrapowers scratch out of `.git/` (e.g.
to `.superpowers/` like upstream, or an OS tempdir), updating `review-package`,
`waves.js` (the implementer's "generate the review packet" step and the reviewer's
read), and any sweep tooling. Tracked as a follow-up; no code move yet.
