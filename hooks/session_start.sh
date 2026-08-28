#!/usr/bin/env bash
# SessionStart hook: inject the plan-routing rule so every session knows to
# layer ultraplan onto writing-plans and to offer /ultrapowers at the handoff.
# Without this, the routing depends on the model noticing the ultraplan skill
# description at exactly the plan-writing moment — probabilistic, not reliable.
# Stdout from a SessionStart command hook becomes session context (exit 0).
set -euo pipefail

# Install the committed harness as a project saved workflow NOW, at session
# start, so the Workflow engine picks it up when it snapshots its saved-
# workflow registry (built once per session; a mid-session copy registers
# only NEXT session). The harness set is fixed — waves.js (`ultrapowers-run`),
# copied by name; the manifest reader died with the registry probe (One
# Driver Phase 0, row 5). Guarded so it can NEVER break the hook's real
# contract — emitting the routing rule below; all output is swallowed.
(
  set +eu
  plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  harnesses="$plugin_root/skills/ultrapowers/harnesses"
  dest="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/workflows"
  mkdir -p "$dest"
  f=waves.js
  if [ -e "$harnesses/$f" ]; then
    # Skip the copy when the installed copy is byte-identical (the common
    # no-change session) — avoids an unconditional 74KB write every start.
    cmp -s "$harnesses/$f" "$dest/$f" 2>/dev/null || cp "$harnesses/$f" "$dest/$f"
    # GC only once the install landed: remove any other .js in the workflows
    # dir — stale orphans from older plugin versions (workflow.js from 0.0.6,
    # probe.js from before Phase 0) would otherwise shadow the harness.
    if [ -e "$dest/$f" ]; then
      for existing in "$dest"/*.js; do
        [ -e "$existing" ] || continue
        [ "$(basename "$existing")" = "$f" ] || rm -f "$existing"
      done
    fi
  fi
) >/dev/null 2>&1 || true

cat <<'EOF'
<ultrapowers-routing>
The ultrapowers plugin is installed. Two standing rules:

1. Whenever you invoke superpowers:writing-plans — for ANY implementation
   plan — also invoke ultrapowers:ultraplan and follow both. ultraplan layers
   additive Type/Depends-on markers and worktree-pure authoring rules; the
   plan remains fully executable by the sequential superpowers executors.

2. At a marked plan's execution handoff, do NOT default to ultrapowers. First run
   the execution-fit analysis, then offer THREE options, parallel first, tagging
   the single best-fit option "(recommended)". Read three signals off the marked
   plan: T = number of implementation tasks; parallel width = is there a wave with
   ≥2 independent tasks, after treating non-text same-file edits between tasks as dependencies (text overlap folds at merge); risk =
   sealed acceptance, a high-stakes surface (auth, payments, migrations, data
   integrity, public API, loops/cursors/pagination/budgets/termination logic), or hard-to-verify behavior. Decide, first match wins:
   risk → Ultrapowers (the risk override); parallel width and T≥4 → Ultrapowers;
   T≤2 → Inline; else → Subagent-Driven. Show a one-line analysis, then:
   1. Ultrapowers — /ultrapowers <plan-path>: commits the plan and drives it on the
      exe.dev fleet (parallel waves in a sandbox, per-task review, the orchestrator
      opens the PR). Selecting ultrapowers authorizes execution: the plan is committed
      and the fleet run launched immediately, with no approval pause.
   2. Subagent-Driven — superpowers:subagent-driven-development (sequential).
   3. Inline — superpowers:executing-plans (inline).
</ultrapowers-routing>
EOF
