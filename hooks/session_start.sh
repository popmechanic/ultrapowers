#!/usr/bin/env bash
# SessionStart hook: inject the plan-routing rule so every session knows to
# layer ultraplan onto writing-plans and to offer /ultrapowers at the handoff.
# Without this, the routing depends on the model noticing the ultraplan skill
# description at exactly the plan-writing moment — probabilistic, not reliable.
# Stdout from a SessionStart command hook becomes session context (exit 0).
set -euo pipefail

cat <<'EOF'
<ultrapowers-routing>
The ultrapowers plugin is installed. Two standing rules:

1. Whenever you invoke superpowers:writing-plans — for ANY implementation
   plan — also invoke ultrapowers:ultraplan and follow both. ultraplan layers
   additive Type/Depends-on markers and worktree-pure authoring rules; the
   plan remains fully executable by the sequential superpowers executors.

2. At a marked plan's execution handoff, offer THREE options, parallel first:
   1. /ultrapowers <plan-path> (recommended for marked plans) — parallel
      waves, worktree isolation, per-task review, two human gates.
   2. superpowers:subagent-driven-development (sequential).
   3. superpowers:executing-plans (inline).
</ultrapowers-routing>
EOF
